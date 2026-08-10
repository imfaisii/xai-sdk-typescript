import { create } from "@bufbuild/protobuf";
import type { Client as ConnectClient } from "@connectrpc/connect";
import {
  Tokenize,
  TokenizeTextRequestSchema,
  type Token,
} from "./gen/xai/api/v1/tokenize_pb.js";

type TokenizeRpc = ConnectClient<typeof Tokenize>;

export class TokenizerClient {
  constructor(private stub: TokenizeRpc) {}

  async tokenizeText(text: string, model: string): Promise<Token[]> {
    const res = await this.stub.tokenizeText(create(TokenizeTextRequestSchema, { text, model }));
    return res.tokens;
  }
}
