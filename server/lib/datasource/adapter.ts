import { QueryParams, QueryResult } from '../types.js';

export interface DataSourceAdapter {
  query(params: QueryParams): Promise<QueryResult>;
}
