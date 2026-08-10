import { create } from "@bufbuild/protobuf";
import type { Client as ConnectClient } from "@connectrpc/connect";
import { BatchRequestSchema, type BatchRequest } from "./gen/xai/api/v1/batch_pb.js";
import { DeferredStatus } from "./gen/xai/api/v1/deferred_pb.js";
import { ImageUrlContentSchema } from "./gen/xai/api/v1/image_pb.js";
import {
  ExtendVideoRequestSchema,
  GenerateVideoRequestSchema,
  GetDeferredVideoRequestSchema,
  Video,
  VideoAspectRatio,
  VideoResolution,
  VideoUrlContentSchema,
  type ExtendVideoRequest,
  type GenerateVideoRequest,
  type GetDeferredVideoResponse,
  type VideoResponse as VideoResponseProto,
} from "./gen/xai/api/v1/video_pb.js";
import type { StartDeferredResponse as DeferredStart } from "./gen/xai/api/v1/deferred_pb.js";
import { PollTimer } from "./util.js";

type VideoRpc = ConnectClient<typeof Video>;

export type VideoAspectRatioName = "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "3:2" | "2:3";
export type VideoResolutionName = "480p" | "720p";

function aspectRatioToProto(ratio?: VideoAspectRatioName): VideoAspectRatio | undefined {
  if (!ratio) return undefined;
  const map: Record<string, VideoAspectRatio> = {
    "16:9": VideoAspectRatio.VIDEO_ASPECT_RATIO_16_9,
    "9:16": VideoAspectRatio.VIDEO_ASPECT_RATIO_9_16,
    "1:1": VideoAspectRatio.VIDEO_ASPECT_RATIO_1_1,
    "4:3": VideoAspectRatio.VIDEO_ASPECT_RATIO_4_3,
    "3:4": VideoAspectRatio.VIDEO_ASPECT_RATIO_3_4,
    "3:2": VideoAspectRatio.VIDEO_ASPECT_RATIO_3_2,
    "2:3": VideoAspectRatio.VIDEO_ASPECT_RATIO_2_3,
  };
  const v = map[ratio];
  if (v === undefined) throw new Error(`Invalid video aspect ratio: ${ratio}`);
  return v;
}

function resolutionToProto(res?: VideoResolutionName): VideoResolution | undefined {
  if (!res) return undefined;
  if (res === "480p") return VideoResolution.VIDEO_RESOLUTION_480P;
  if (res === "720p") return VideoResolution.VIDEO_RESOLUTION_720P;
  throw new Error(`Invalid video resolution: ${res}`);
}

export interface VideoGenerateOptions {
  imageUrl?: string;
  imageFileId?: string;
  videoUrl?: string;
  videoFileId?: string;
  duration?: number;
  aspectRatio?: VideoAspectRatioName;
  resolution?: VideoResolutionName;
  referenceImageUrls?: string[];
  referenceImageFileIds?: string[];
}

function imageContent(url?: string, fileId?: string) {
  if (url) return create(ImageUrlContentSchema, { imageUrl: url });
  if (fileId) return create(ImageUrlContentSchema, { imageUrl: `file://${fileId}` });
  return undefined;
}

function videoContent(url?: string, fileId?: string) {
  if (url) return create(VideoUrlContentSchema, { url });
  if (fileId) return create(VideoUrlContentSchema, { url: `file://${fileId}` });
  return undefined;
}

function makeGenerateRequest(prompt: string, model: string, options: VideoGenerateOptions = {}): GenerateVideoRequest {
  const refs = [
    ...(options.referenceImageFileIds ?? []).map((id) => create(ImageUrlContentSchema, { imageUrl: `file://${id}` })),
    ...(options.referenceImageUrls ?? []).map((url) => create(ImageUrlContentSchema, { imageUrl: url })),
  ];
  return create(GenerateVideoRequestSchema, {
    prompt,
    model,
    duration: options.duration,
    aspectRatio: aspectRatioToProto(options.aspectRatio),
    resolution: resolutionToProto(options.resolution),
    image: imageContent(options.imageUrl, options.imageFileId),
    video: videoContent(options.videoUrl, options.videoFileId),
    referenceImages: refs,
  });
}

function makeExtendRequest(
  prompt: string,
  model: string,
  options: { videoUrl?: string; videoFileId?: string; duration?: number },
): ExtendVideoRequest {
  return create(ExtendVideoRequestSchema, {
    prompt,
    model,
    duration: options.duration,
    video: videoContent(options.videoUrl, options.videoFileId),
  });
}

export class VideoResponse {
  constructor(readonly proto: VideoResponseProto) {}

  get url(): string | undefined {
    return this.proto.video?.url;
  }
  get duration(): number | undefined {
    return this.proto.video?.duration;
  }
  get model(): string {
    return this.proto.model;
  }
  get usage() {
    return this.proto.usage;
  }
  get progress(): number | undefined {
    return this.proto.progress;
  }
  get error() {
    return this.proto.error;
  }
}

export class VideoClient {
  constructor(private stub: VideoRpc) {}

  prepare(prompt: string, model: string, options?: VideoGenerateOptions & { batchRequestId?: string }): BatchRequest {
    const request = makeGenerateRequest(prompt, model, options);
    return create(BatchRequestSchema, {
      batchRequestId: options?.batchRequestId ?? "",
      request: { case: "videoRequest", value: request },
    });
  }

  prepareExtension(
    prompt: string,
    model: string,
    options: { videoUrl?: string; videoFileId?: string; duration?: number; batchRequestId?: string },
  ): BatchRequest {
    const request = makeExtendRequest(prompt, model, options);
    return create(BatchRequestSchema, {
      batchRequestId: options?.batchRequestId ?? "",
      request: { case: "videoExtensionRequest", value: request },
    });
  }

  async start(prompt: string, model: string, options?: VideoGenerateOptions): Promise<DeferredStart> {
    return this.stub.generateVideo(makeGenerateRequest(prompt, model, options)) as Promise<DeferredStart>;
  }

  async get(requestId: string): Promise<GetDeferredVideoResponse> {
    return this.stub.getDeferredVideo(create(GetDeferredVideoRequestSchema, { requestId }));
  }

  async generate(
    prompt: string,
    model: string,
    options?: VideoGenerateOptions & { timeoutMs?: number; intervalMs?: number },
  ): Promise<VideoResponse> {
    const started = await this.start(prompt, model, options);
    const timer = new PollTimer({
      timeoutMs: options?.timeoutMs ?? 30 * 60 * 1000,
      intervalMs: options?.intervalMs ?? 1000,
    });
    while (true) {
      const r = await this.get(started.requestId);
      if (r.status === DeferredStatus.DONE) {
        if (!r.response) throw new Error("Video generation done but response missing.");
        if (r.response.error) {
          throw new Error(r.response.error.message || "Video generation failed");
        }
        return new VideoResponse(r.response);
      }
      if (r.status === DeferredStatus.EXPIRED) throw new Error("Video generation request expired.");
      if (r.status === DeferredStatus.FAILED) {
        throw new Error(r.response?.error?.message || "Video generation failed.");
      }
      await timer.waitOrThrow("waiting for video generation");
    }
  }

  async extendStart(
    prompt: string,
    model: string,
    options: { videoUrl?: string; videoFileId?: string; duration?: number },
  ): Promise<DeferredStart> {
    return this.stub.extendVideo(makeExtendRequest(prompt, model, options)) as Promise<DeferredStart>;
  }

  async extend(
    prompt: string,
    model: string,
    options: {
      videoUrl?: string;
      videoFileId?: string;
      duration?: number;
      timeoutMs?: number;
      intervalMs?: number;
    },
  ): Promise<VideoResponse> {
    const started = await this.extendStart(prompt, model, options);
    const timer = new PollTimer({
      timeoutMs: options.timeoutMs ?? 30 * 60 * 1000,
      intervalMs: options.intervalMs ?? 1000,
    });
    while (true) {
      const r = await this.get(started.requestId);
      if (r.status === DeferredStatus.DONE) {
        if (!r.response) throw new Error("Video extension done but response missing.");
        if (r.response.error) throw new Error(r.response.error.message || "Video extension failed");
        return new VideoResponse(r.response);
      }
      if (r.status === DeferredStatus.EXPIRED) throw new Error("Video extension request expired.");
      if (r.status === DeferredStatus.FAILED) {
        throw new Error(r.response?.error?.message || "Video extension failed.");
      }
      await timer.waitOrThrow("waiting for video extension");
    }
  }
}

export type { DeferredStart as StartDeferredResponse };
