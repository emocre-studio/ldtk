export interface ImageRecord {
  id: string;
  name: string;
  pxWid: number;
  pxHei: number;
}

export interface StoredImage {
  bytes: Buffer;
  contentType: string;
}

export interface Storage {
  getVersion(projectId: string): Promise<string>;
  /** Incrementa a versão do projeto (usado por mutações que não escrevem manifesto/nível). */
  bumpVersion(projectId: string): Promise<string>;
  getManifest(projectId: string): Promise<unknown>;
  putManifest(projectId: string, manifest: unknown): Promise<string>;
  listLevels(projectId: string): Promise<Record<string, unknown>>;
  getLevel(projectId: string, iid: string): Promise<unknown | null>;
  putLevel(projectId: string, iid: string, level: unknown): Promise<string>;
  deleteLevel(projectId: string, iid: string): Promise<string | null>;
  listImages(projectId: string): Promise<ImageRecord[]>;
  putImage(
    projectId: string,
    bytes: Buffer,
    name: string,
    contentType: string,
  ): Promise<ImageRecord>;
  getImage(projectId: string, imgId: string): Promise<StoredImage | null>;
  deleteImage(projectId: string, imgId: string): Promise<boolean>;
}
