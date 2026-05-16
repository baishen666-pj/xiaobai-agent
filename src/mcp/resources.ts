export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

export interface MCPResourceProvider {
  listResources(): Promise<MCPResource[]>;
  readResource(uri: string): Promise<MCPResourceContent[]>;
}
