/** Web never has local file:// URIs; uploads there fetch blob:/data: URIs instead. */
export function blobFromLocalUri(_uri: string): Blob {
  throw new Error("Local file URIs are not available on web.");
}

export function readLocalFileBase64(_uri: string): Promise<string> {
  return Promise.reject(new Error("Local file URIs are not available on web."));
}
