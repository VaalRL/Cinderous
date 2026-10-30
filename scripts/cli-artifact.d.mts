// cli-artifact.mjs 的型別（官網測試匯入 ARTIFACT_NAME 比對下載連結，ADR-0405）。
export declare const ARTIFACT_NAME: string;
export declare function checksumLine(buf: Uint8Array, name: string): string;
export declare function checkBundle(source: string): void;
