import { create } from "@bufbuild/protobuf";
import type { Client as ConnectClient } from "@connectrpc/connect";
import {
  BatchRequestSchema,
  type BatchRequest,
} from "./gen/xai/api/v1/batch_pb.js";
import {
  GenerateImageRequestSchema,
  Image,
  ImageAspectRatio,
  ImageFormat,
  ImageResolution,
  ImageUrlContentSchema,
  type GenerateImageRequest,
  type ImageResponse as ImageResponseProto,
  type GeneratedImage,
} from "./gen/xai/api/v1/image_pb.js";

type ImageRpc = ConnectClient<typeof Image>;

export type ImageFormatName = "url" | "base64";
export type ImageAspectRatioName =
  | "1:1"
  | "16:9"
  | "9:16"
  | "4:3"
  | "3:4"
  | "3:2"
  | "2:3"
  | "2:1"
  | "1:2"
  | "20:9"
  | "9:20"
  | "19.5:9"
  | "9:19.5"
  | "auto";
export type ImageResolutionName = "1k" | "2k";

function imageFormatToProto(format?: ImageFormatName): ImageFormat {
  if (format === "base64") return ImageFormat.IMG_FORMAT_BASE64;
  return ImageFormat.IMG_FORMAT_URL;
}

function aspectRatioToProto(ratio?: ImageAspectRatioName): ImageAspectRatio | undefined {
  if (!ratio) return undefined;
  const map: Record<ImageAspectRatioName, ImageAspectRatio> = {
    "1:1": ImageAspectRatio.IMG_ASPECT_RATIO_1_1,
    "16:9": ImageAspectRatio.IMG_ASPECT_RATIO_16_9,
    "9:16": ImageAspectRatio.IMG_ASPECT_RATIO_9_16,
    "4:3": ImageAspectRatio.IMG_ASPECT_RATIO_4_3,
    "3:4": ImageAspectRatio.IMG_ASPECT_RATIO_3_4,
    "3:2": ImageAspectRatio.IMG_ASPECT_RATIO_3_2,
    "2:3": ImageAspectRatio.IMG_ASPECT_RATIO_2_3,
    "2:1": ImageAspectRatio.IMG_ASPECT_RATIO_2_1,
    "1:2": ImageAspectRatio.IMG_ASPECT_RATIO_1_2,
    "20:9": ImageAspectRatio.IMG_ASPECT_RATIO_20_9,
    "9:20": ImageAspectRatio.IMG_ASPECT_RATIO_9_20,
    "19.5:9": ImageAspectRatio.IMG_ASPECT_RATIO_19_5_9,
    "9:19.5": ImageAspectRatio.IMG_ASPECT_RATIO_9_19_5,
    auto: ImageAspectRatio.IMG_ASPECT_RATIO_AUTO,
  };
  const v = map[ratio];
  if (v === undefined) throw new Error(`Invalid aspect ratio: ${ratio}`);
  return v;
}

function resolutionToProto(res?: ImageResolutionName): ImageResolution | undefined {
  if (!res) return undefined;
  if (res === "1k") return ImageResolution.IMG_RESOLUTION_1K;
  if (res === "2k") return ImageResolution.IMG_RESOLUTION_2K;
  throw new Error(`Invalid resolution: ${res}`);
}

export interface ImageSampleOptions {
  imageUrl?: string;
  imageFileId?: string;
  imageUrls?: string[];
  imageFileIds?: string[];
  user?: string;
  imageFormat?: ImageFormatName;
  aspectRatio?: ImageAspectRatioName;
  resolution?: ImageResolutionName;
  n?: number;
}

function makeGenerateRequest(prompt: string, model: string, options: ImageSampleOptions = {}): GenerateImageRequest {
  const singleCount = [options.imageUrl, options.imageFileId].filter((x) => x !== undefined).length;
  const multi = (options.imageUrls?.length ?? 0) + (options.imageFileIds?.length ?? 0);
  if (singleCount > 1) throw new Error("Only one of imageUrl or imageFileId may be set.");
  if (singleCount && multi) throw new Error("Cannot combine single-image and multi-image inputs.");

  let image = undefined as ReturnType<typeof create<typeof ImageUrlContentSchema>> | undefined;
  if (options.imageUrl) {
    image = create(ImageUrlContentSchema, { imageUrl: options.imageUrl });
  } else if (options.imageFileId) {
    image = create(ImageUrlContentSchema, { imageUrl: `file://${options.imageFileId}` });
  }

  const images: ReturnType<typeof create<typeof ImageUrlContentSchema>>[] = [];
  for (const id of options.imageFileIds ?? []) {
    images.push(create(ImageUrlContentSchema, { imageUrl: `file://${id}` }));
  }
  for (const url of options.imageUrls ?? []) {
    images.push(create(ImageUrlContentSchema, { imageUrl: url }));
  }

  return create(GenerateImageRequestSchema, {
    prompt,
    model,
    n: options.n,
    user: options.user ?? "",
    format: imageFormatToProto(options.imageFormat),
    aspectRatio: aspectRatioToProto(options.aspectRatio),
    resolution: resolutionToProto(options.resolution),
    image,
    images,
  });
}

export class ImageResponse {
  constructor(
    readonly proto: ImageResponseProto,
    private index: number,
  ) {}

  private get generated(): GeneratedImage | undefined {
    return this.proto.images[this.index];
  }

  get url(): string | undefined {
    const img = this.generated?.image;
    return img?.case === "url" ? img.value : undefined;
  }

  get base64(): string | undefined {
    const img = this.generated?.image;
    return img?.case === "base64" ? img.value : undefined;
  }

  get model(): string {
    return this.proto.model;
  }

  get usage() {
    return this.proto.usage;
  }

  get respectModeration(): boolean {
    return this.generated?.respectModeration ?? false;
  }
}

export class ImageClient {
  constructor(private stub: ImageRpc) {}

  prepare(prompt: string, model: string, options?: ImageSampleOptions & { batchRequestId?: string }): BatchRequest {
    const request = makeGenerateRequest(prompt, model, options);
    return create(BatchRequestSchema, {
      batchRequestId: options?.batchRequestId ?? "",
      request: { case: "imageRequest", value: request },
    });
  }

  async sample(prompt: string, model: string, options?: ImageSampleOptions): Promise<ImageResponse> {
    const request = makeGenerateRequest(prompt, model, options);
    const responsePb = await this.stub.generateImage(request);
    return new ImageResponse(responsePb, 0);
  }

  async sampleBatch(prompt: string, model: string, n: number, options?: ImageSampleOptions): Promise<ImageResponse[]> {
    const request = makeGenerateRequest(prompt, model, { ...options, n });
    const responsePb = await this.stub.generateImage(request);
    return responsePb.images.map((_, i) => new ImageResponse(responsePb, i));
  }
}
