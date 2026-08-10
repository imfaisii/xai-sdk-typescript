import { create } from "@bufbuild/protobuf";
import { EmptySchema } from "@bufbuild/protobuf/wkt";
import type { Client as ConnectClient } from "@connectrpc/connect";
import { Auth, type ApiKey } from "./gen/xai/api/v1/auth_pb.js";

type AuthRpc = ConnectClient<typeof Auth>;

export class AuthClient {
  constructor(private stub: AuthRpc) {}

  async getApiKeyInfo(): Promise<ApiKey> {
    return this.stub.get_api_key_info(create(EmptySchema));
  }
}
