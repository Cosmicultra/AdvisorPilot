export { sendGmailMessage, type SendGmailResult } from "./send";
export { getGmailAccessToken, GmailNotConnectedError } from "./oauth";
export { persistGmailRefreshToken, loadGmailRefreshToken } from "./token-store";
export {
  getAdvisorProfile,
  buildSignedEmailBodies,
  buildPlainSignature,
  buildHtmlSignature,
  type AdvisorProfileRecord,
} from "./signature";
export { gmailSendNeedsGoogleReconnect } from "./errors";
export { base64UrlEncode, buildSimpleMultipartEmail, escapeHtml, plainParagraphsToHtml } from "./mime";
