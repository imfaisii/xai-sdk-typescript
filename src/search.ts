import { create } from "@bufbuild/protobuf";
import {
  NewsSourceSchema,
  RssSourceSchema,
  SearchMode,
  SearchParametersSchema,
  SourceSchema,
  WebSourceSchema,
  XSourceSchema,
  type SearchParameters as SearchParametersProto,
  type Source,
} from "./gen/xai/api/v1/chat_pb.js";
import { dateToTimestamp } from "./util.js";

export type SearchModeName = "auto" | "on" | "off";

export interface SearchParametersInput {
  sources?: Source[];
  mode?: SearchModeName;
  fromDate?: Date;
  toDate?: Date;
  returnCitations?: boolean;
  maxSearchResults?: number;
}

export class SearchParameters {
  sources?: Source[];
  mode: SearchModeName;
  fromDate?: Date;
  toDate?: Date;
  returnCitations: boolean;
  maxSearchResults?: number;

  constructor(input: SearchParametersInput = {}) {
    this.sources = input.sources;
    this.mode = input.mode ?? "auto";
    this.fromDate = input.fromDate;
    this.toDate = input.toDate;
    this.returnCitations = input.returnCitations ?? true;
    this.maxSearchResults = input.maxSearchResults;
  }

  toProto(): SearchParametersProto {
    return create(SearchParametersSchema, {
      sources: this.sources ?? [],
      mode: searchModeToProto(this.mode),
      fromDate: this.fromDate ? dateToTimestamp(this.fromDate) : undefined,
      toDate: this.toDate ? dateToTimestamp(this.toDate) : undefined,
      returnCitations: this.returnCitations,
      maxSearchResults: this.maxSearchResults,
    });
  }
}

function searchModeToProto(mode: SearchModeName): SearchMode {
  switch (mode) {
    case "auto":
      return SearchMode.AUTO_SEARCH_MODE;
    case "on":
      return SearchMode.ON_SEARCH_MODE;
    case "off":
      return SearchMode.OFF_SEARCH_MODE;
    default:
      throw new Error(`Invalid search mode: ${mode}`);
  }
}

export function webSource(options?: {
  country?: string;
  excludedWebsites?: string[];
  allowedWebsites?: string[];
  safeSearch?: boolean;
}): Source {
  return create(SourceSchema, {
    source: {
      case: "web",
      value: create(WebSourceSchema, {
        country: options?.country,
        excludedWebsites: options?.excludedWebsites ?? [],
        allowedWebsites: options?.allowedWebsites ?? [],
        safeSearch: options?.safeSearch ?? true,
      }),
    },
  });
}

export function newsSource(options?: {
  country?: string;
  excludedWebsites?: string[];
  safeSearch?: boolean;
}): Source {
  return create(SourceSchema, {
    source: {
      case: "news",
      value: create(NewsSourceSchema, {
        country: options?.country,
        excludedWebsites: options?.excludedWebsites ?? [],
        safeSearch: options?.safeSearch ?? true,
      }),
    },
  });
}

export function xSource(options?: {
  includedXHandles?: string[];
  excludedXHandles?: string[];
  postFavoriteCount?: number;
  postViewCount?: number;
}): Source {
  return create(SourceSchema, {
    source: {
      case: "x",
      value: create(XSourceSchema, {
        includedXHandles: options?.includedXHandles ?? [],
        excludedXHandles: options?.excludedXHandles ?? [],
        postFavoriteCount: options?.postFavoriteCount,
        postViewCount: options?.postViewCount,
      }),
    },
  });
}

export function rssSource(links: string[]): Source {
  return create(SourceSchema, {
    source: {
      case: "rss",
      value: create(RssSourceSchema, { links: [...links] }),
    },
  });
}
