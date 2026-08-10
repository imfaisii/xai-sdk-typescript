import {
  ServiceTier as ServiceTierEnum,
  ServiceTierSchema,
} from "./gen/xai/api/v1/usage_pb.js";

export type ServiceTierName = "default" | "priority";

export function serviceTierToProto(tier: ServiceTierName | ServiceTierEnum | undefined): ServiceTierEnum | undefined {
  if (tier === undefined) return undefined;
  if (typeof tier !== "string") return tier;
  switch (tier) {
    case "default":
      return ServiceTierEnum.DEFAULT;
    case "priority":
      return ServiceTierEnum.PRIORITY;
    default:
      throw new Error(`Invalid service tier: ${tier}`);
  }
}

export function serviceTierFromProto(tier: ServiceTierEnum | undefined): ServiceTierName | undefined {
  if (tier === undefined) return undefined;
  switch (tier) {
    case ServiceTierEnum.DEFAULT:
      return "default";
    case ServiceTierEnum.PRIORITY:
      return "priority";
    default:
      return undefined;
  }
}

export { ServiceTierEnum, ServiceTierSchema };
