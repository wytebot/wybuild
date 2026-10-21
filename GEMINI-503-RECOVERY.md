# WyBuild deterministic automation

WyBuild no longer calls Gemini or any other AI provider for build diagnosis, repair guidance, or integration templates. No Gemini API key or model environment variable is required.

The build doctor classifies known error signatures and returns evidence-backed suggestions. Integration installs use version-aware static templates and atomic GitHub commits. Unknown errors are labeled as unclassified rather than guessed. Some operations still require provider configuration (for example Firebase project settings, payment backends, or push-delivery services) and the UI reports those steps explicitly.
