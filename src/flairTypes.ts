export type JsonApiResource = {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<
    string,
    {
      data?: { id: string; type: string } | Array<{ id: string; type: string }> | null;
      links?: { self?: string; related?: string };
      meta?: Record<string, unknown>;
    }
  >;
  links?: Record<string, unknown>;
};

export type JsonApiDocument = {
  data?: JsonApiResource | JsonApiResource[] | null;
  links?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  included?: JsonApiResource[];
  errors?: Array<Record<string, unknown>>;
};

export type ApiRootLink = {
  self: string;
  type: string;
};
