# Deterministic integration reliability

WyBuild uses a deterministic integration catalog instead of an AI provider. Supported templates are committed atomically through the GitHub Git Trees API. Capacitor plugin versions are added only when the repository declares a detectable Capacitor 5, 6, or 7 major version.

A committed helper is not the same as a complete application UI integration. WyBuild reports generated helper files, required configuration, and verification steps. Run the project build and test the resulting APK before release. Secrets and external service setup are never invented.
