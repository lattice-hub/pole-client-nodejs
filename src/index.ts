export {
  TARGET_SERVICE_HEADER_NAMES,
  TargetServiceError,
  createTargetService,
  encodeTargetServiceMetadata,
  encodeTargetServiceMetadataWithTrafficContext,
  type Metadata,
  type TargetService,
  type TargetServiceDiagnostic,
  type TargetServiceInput
} from "./target-service.js";

export {
  BAGGAGE_HEADER_NAME,
  TrafficContextError,
  attachTrafficContext,
  createOpenTelemetryTrafficContextAdapter,
  createTrafficContext,
  currentTrafficContext,
  extractTrafficContext,
  injectTrafficContext,
  installOpenTelemetryTrafficContextAdapter,
  resetTrafficContext,
  runWithTrafficContext,
  type OpenTelemetryApiLike,
  type OpenTelemetryBaggageEntryLike,
  type OpenTelemetryBaggageLike,
  type OpenTelemetryContextLike,
  type OpenTelemetryTrafficContextAdapter,
  type TrafficContext,
  type TrafficContextDiagnostic,
  type TrafficContextInput,
  type TrafficContextScope
} from "./traffic-context.js";

export {
  DEFAULT_SIDECAR_SOCKET,
  SDK_LANGUAGE,
  SDK_VERSION,
  SidecarBootstrapError,
  SidecarSession,
  SidecarUnavailableError,
  connectSidecarSession,
  type ListenerAddresses,
  type LocalServiceRegistrationInput,
  type LocalServiceState,
  type LocalServiceStatus,
  type SidecarProtocol,
  type SidecarSessionOptions
} from "./sidecar-session.js";
