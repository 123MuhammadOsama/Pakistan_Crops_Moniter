import Dexie, { type Table } from "dexie";

export type FarmRecord = {
  id?: number;
  name: string;
  coords: { lat: number; lng: number }[];
  area: number;
  createdAt: number;
};

class FarmDb extends Dexie {
  farms!: Table<FarmRecord, number>;

  constructor() {
    super("farm-db");
    this.version(1).stores({
      farms: "++id, name, createdAt",
    });
  }
}

let dbInstance: FarmDb | null = null;

export const getDb = () => {
  if (!dbInstance) {
    dbInstance = new FarmDb();
  }
  return dbInstance;
};
