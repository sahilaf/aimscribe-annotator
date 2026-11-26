// Settings for this deployment. The OAuth client ID is public by design (it is not a secret):
// what protects the data is Drive sharing and the test-user list on the Google consent screen.
// How to make one: annotator/README.md, "1. Google Cloud setup". You can instead set
// VITE_GOOGLE_CLIENT_ID on your host at build time; a value here wins.
window.AIMSCRIBE_CONFIG = {
  clientId: "", // e.g. "1234567890-abc123.apps.googleusercontent.com"
};
