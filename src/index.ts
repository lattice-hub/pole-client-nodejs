export {
  TARGET_SERVICE_HEADER_NAMES,
  TargetServiceError,
  createTargetService,
  encodeTargetServiceMetadata,
  type Metadata,
  type TargetService,
  type TargetServiceDiagnostic,
  type TargetServiceInput
} from "./target-service.js";

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
