/**
 * Studio owns the live wire schema. Runtime produces these values through the
 * public `@fluojs/studio` seam rather than maintaining a duplicate DTO.
 */
export type {
  StudioDisconnectPayload,
  StudioGraphEdge,
  StudioGraphEdgeKind,
  StudioGraphNode,
  StudioGraphNodeKind,
  StudioHeartbeatPayload,
  StudioLiveDiagnostic,
  StudioLiveEventBase,
  StudioLiveEventSource,
  StudioParsedLiveEvent as StudioLiveEvent,
  StudioParsedLiveSnapshot as StudioLiveSnapshot,
  StudioNormalizedRouteDescriptor as StudioRouteDescriptor,
  StudioRequestStatus,
  StudioRequestTrace,
  StudioRestartPayload,
  StudioRouteKind,
} from '@fluojs/studio';
