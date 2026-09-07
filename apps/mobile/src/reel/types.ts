/** The artefact: a real video file, not a link to one. */
export interface ReelFile {
  /** object URL, valid until `releaseFile` */
  url: string;
  name: string;
  mime: string;
  bytes: number;
}

export interface ReelStageHandle {
  /** Restart the preview from the first frame. */
  play: () => void;
  /**
   * Play once while recording, resolving with the file. Returns `null` where recording is not
   * possible — the caller must show `reelUnsupported` rather than a button that does nothing.
   */
  record: (onProgress: (p: number) => void) => Promise<ReelFile | null>;
}
