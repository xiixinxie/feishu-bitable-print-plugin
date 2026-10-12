export type Orientation = 'portrait' | 'landscape';

export type FieldMetaLite = {
  id: string;
  name: string;
  type: number;
  property?: { tableId?: string; multiple?: boolean };
};

export type LinkedFieldGroup = {
  parent: FieldMetaLite;
  fields: FieldMetaLite[];
  tableName: string;
  loading?: boolean;
};

export type PrintCell = { text: string; images?: string[]; recordIds?: string[] };

export type PrintRow = {
  recordId: string;
  values: Record<string, PrintCell>;
  linkedValues: Record<string, Record<string, PrintCell>>;
};

export type PrintTemplate = {
  id: string;
  name: string;
  tableId?: string;
  tableName: string;
  html: string;
  orientation: Orientation;
  updatedAt: number;
};

// Kept for the small legacy settings component that ships with the starter repo.
export type IFieldMetaSettings = {
  fieldId: string;
  name: string;
  hidden: boolean;
  width?: number;
};
