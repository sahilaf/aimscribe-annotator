// Settings for this deployment. The OAuth client ID is public by design (it is not a secret):
// what protects the data is Drive sharing and the test-user list on the Google consent screen.
// How to make one: README.md, "1. Google Cloud setup". You can instead set
// VITE_GOOGLE_CLIENT_ID on your host at build time; a value here wins.
// Never put the client *secret* here or anywhere in this repo: the app does not use it.
window.AIMSCRIBE_CONFIG = {
  clientId: "285266232303-pifn3lmtami33mmccikfof141r2c9sb4.apps.googleusercontent.com",
};
