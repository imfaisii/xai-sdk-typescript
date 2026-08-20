import { create } from "@bufbuild/protobuf";
import type { Client as ConnectClient } from "@connectrpc/connect";
import { BatchRequestSchema, type BatchRequest } from "./gen/xai/api/v1/batch_pb.js";
import { DeferredStatus } from "./gen/xai/api/v1/deferred_pb.js";
import { ImageUrlContentSchema } from "./gen/xai/api/v1/image_pb.js";
import {
  AudioUrlContentSchema,
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
import {
  fileOutputFromPb,
  storageOptionsToPb,
  type FileOutputInfo,
  type StorageOptionsInput,
} from "./storage.js";
import { costUsdFromUsage } from "./cost.js";
import { VideoGenerationError } from "./errors.js";
import { PollTimer } from "./util.js";

type VideoRpc = ConnectClient<typeof Video>;

/** Models supported for video generation. Other strings are still accepted. */
export type VideoGenerationModel = "grok-imagine-video" | "grok-imagine-video-1.5";

export const DEFAULT_VIDEO_POLL_INTERVAL = 1000;
export const DEFAULT_VIDEO_TIMEOUT = 10 * 60 * 1000;

export type VideoAspectRatioName = "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "3:2" | "2:3";
export type VideoResolutionName = "480p" | "720p" | "1080p";

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
  if (res === "1080p") return VideoResolution.VIDEO_RESOLUTION_1080P;
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
  referenceAudios?: { voiceId: string }[];
  generateAudio?: boolean;
  storageOptions?: StorageOptionsInput;
}

function imageContent(url?: string, fileId?: string) {
  if (url) return create(ImageUrlContentSchema, { source: { case: "imageUrl", value: url } });
  if (fileId) return create(ImageUrlContentSchema, { source: { case: "fileId", value: fileId } });
  return undefined;
}

function videoContent(url?: string, fileId?: string) {
  if (url) return create(VideoUrlContentSchema, { source: { case: "url", value: url } });
  if (fileId) return create(VideoUrlContentSchema, { source: { case: "fileId", value: fileId } });
  return undefined;
}

function makeGenerateRequest(
  prompt: string,
  model: VideoGenerationModel | (string & {}),
  options: VideoGenerateOptions = {},
): GenerateVideoRequest {
  const refs = [
    ...(options.referenceImageFileIds ?? []).map((id) =>
      create(ImageUrlContentSchema, { source: { case: "fileId", value: id } }),
    ),
    ...(options.referenceImageUrls ?? []).map((url) =>
      create(ImageUrlContentSchema, { source: { case: "imageUrl", value: url } }),
    ),
  ];
  const referenceAudios = (options.referenceAudios ?? []).map((audio) =>
    create(AudioUrlContentSchema, { source: { case: "voiceId", value: audio.voiceId } }),
  );
  return create(GenerateVideoRequestSchema, {
    prompt,
    model,
    duration: options.duration,
    aspectRatio: aspectRatioToProto(options.aspectRatio),
    resolution: resolutionToProto(options.resolution),
    image: imageContent(options.imageUrl, options.imageFileId),
    video: videoContent(options.videoUrl, options.videoFileId),
    referenceImages: refs,
    referenceAudios,
    generateAudio: options.generateAudio,
    storageOptions: storageOptionsToPb(options.storageOptions),
  });
}

function makeExtendRequest(
  prompt: string,
  model: VideoGenerationModel | (string & {}),
  options: { videoUrl?: string; videoFileId?: string; duration?: number; storageOptions?: StorageOptionsInput },
): ExtendVideoRequest {
  return create(ExtendVideoRequestSchema, {
    prompt,
    model,
    duration: options.duration,
    video: videoContent(options.videoUrl, options.videoFileId),
    storageOptions: storageOptionsToPb(options.storageOptions),
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
  get costUsd(): number | undefined {
    return costUsdFromUsage(this.proto.usage);
  }
  get progress(): number | undefined {
    return this.proto.progress;
  }
  get error() {
    return this.proto.error;
  }
  get fileOutput(): FileOutputInfo | undefined {
    return fileOutputFromPb(this.proto.video?.fileOutput);
  }
  get storageError(): string | undefined {
    return this.proto.video?.storageError;
  }
  get publicUrl(): string | undefined {
    return this.fileOutput?.publicUrl;
  }
  get publicUrlError(): string | undefined {
    return this.fileOutput?.publicUrlError;
  }
}

export class VideoClient {
  constructor(private stub: VideoRpc) {}

  prepare(
    prompt: string,
    model: VideoGenerationModel | (string & {}),
    options?: VideoGenerateOptions & { batchRequestId?: string },
  ): BatchRequest {
    const request = makeGenerateRequest(prompt, model, options);
    return create(BatchRequestSchema, {
      batchRequestId: options?.batchRequestId ?? "",
      request: { case: "videoRequest", value: request },
    });
  }

  prepareExtension(
    prompt: string,
    model: VideoGenerationModel | (string & {}),
    options: {
      videoUrl?: string;
      videoFileId?: string;
      duration?: number;
      batchRequestId?: string;
      storageOptions?: StorageOptionsInput;
    },
  ): BatchRequest {
    const request = makeExtendRequest(prompt, model, options);
    return create(BatchRequestSchema, {
      batchRequestId: options?.batchRequestId ?? "",
      request: { case: "videoExtensionRequest", value: request },
    });
  }

  async start(
    prompt: string,
    model: VideoGenerationModel | (string & {}),
    options?: VideoGenerateOptions,
  ): Promise<DeferredStart> {
    return this.stub.generateVideo(makeGenerateRequest(prompt, model, options)) as Promise<DeferredStart>;
  }

  async get(requestId: string): Promise<GetDeferredVideoResponse> {
    return this.stub.getDeferredVideo(create(GetDeferredVideoRequestSchema, { requestId }));
  }

  async generate(
    prompt: string,
    model: VideoGenerationModel | (string & {}),
    options?: VideoGenerateOptions & { timeoutMs?: number; intervalMs?: number },
  ): Promise<VideoResponse> {
    const started = await this.start(prompt, model, options);
    const timer = new PollTimer({
      timeoutMs: options?.timeoutMs ?? DEFAULT_VIDEO_TIMEOUT,
      intervalMs: options?.intervalMs ?? DEFAULT_VIDEO_POLL_INTERVAL,
    });
    while (true) {
      const r = await this.get(started.requestId);
      if (r.status === DeferredStatus.DONE) {
        if (!r.response) throw new Error("Video generation done but response missing.");
        if (r.response.error) {
          throw new VideoGenerationError(
            r.response.error.message || "Video generation failed",
            r.response.error.code || "UNKNOWN",
          );
        }
        return new VideoResponse(r.response);
      }
      if (r.status === DeferredStatus.EXPIRED) throw new Error("Video generation request expired.");
      if (r.status === DeferredStatus.FAILED) {
        throw new VideoGenerationError(
          r.response?.error?.message || "Video generation failed.",
          r.response?.error?.code || "UNKNOWN",
        );
      }
      await timer.waitOrThrow("waiting for video generation");
    }
  }

  async extendStart(
    prompt: string,
    model: VideoGenerationModel | (string & {}),
    options: { videoUrl?: string; videoFileId?: string; duration?: number; storageOptions?: StorageOptionsInput },
  ): Promise<DeferredStart> {
    return this.stub.extendVideo(makeExtendRequest(prompt, model, options)) as Promise<DeferredStart>;
  }

  async extend(
    prompt: string,
    model: VideoGenerationModel | (string & {}),
    options: {
      videoUrl?: string;
      videoFileId?: string;
      duration?: number;
      storageOptions?: StorageOptionsInput;
      timeoutMs?: number;
      intervalMs?: number;
    },
  ): Promise<VideoResponse> {
    const started = await this.extendStart(prompt, model, options);
    const timer = new PollTimer({
      timeoutMs: options.timeoutMs ?? DEFAULT_VIDEO_TIMEOUT,
      intervalMs: options.intervalMs ?? DEFAULT_VIDEO_POLL_INTERVAL,
    });
    while (true) {
      const r = await this.get(started.requestId);
      if (r.status === DeferredStatus.DONE) {
        if (!r.response) throw new Error("Video extension done but response missing.");
        if (r.response.error) {
          throw new VideoGenerationError(
            r.response.error.message || "Video extension failed",
            r.response.error.code || "UNKNOWN",
          );
        }
        return new VideoResponse(r.response);
      }
      if (r.status === DeferredStatus.EXPIRED) throw new Error("Video extension request expired.");
      if (r.status === DeferredStatus.FAILED) {
        throw new VideoGenerationError(
          r.response?.error?.message || "Video extension failed.",
          r.response?.error?.code || "UNKNOWN",
        );
      }
      await timer.waitOrThrow("waiting for video extension");
    }
  }
}

export type { DeferredStart as StartDeferredResponse };
