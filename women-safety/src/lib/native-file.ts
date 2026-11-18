import { File } from "expo-file-system";

/**
 * Wraps a local file URI (file://…) in a real Blob.
 * Expo's fetch (the global fetch since SDK 52+) cannot send React Native's
 * `{ uri, name, type }` FormData parts, so uploads must use a Blob instead.
 */
export function blobFromLocalUri(uri: string): Blob {
  return new File(uri.startsWith("/") ? `file://${uri}` : uri);
}

/** Reads a local file as base64 (used when a multipart upload fails on the device). */
export function readLocalFileBase64(uri: string): Promise<string> {
  return new File(uri.startsWith("/") ? `file://${uri}` : uri).base64();
}
