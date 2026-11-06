export type HttpMethod =
  | "GET"
  | "PUT"
  | "POST"
  | "DELETE"
  | "OPTIONS"
  | "HEAD"
  | "PATCH"
  | "TRACE";

export type ContractChange = {
  id: string;
  operation: { method: HttpMethod | null; path: string | null };
  breaking: boolean;
  severity: "ERR" | "WARN";
  description: string;
  category?: string;
  properties?: Record<string, unknown>;
};

export type ConsumerReference = {
  file: string;
  line: number;
  method: HttpMethod;
  path: string;
  confidence: "confirmed_usage" | "potential_usage";
};

export type ChangeImpact = {
  change: ContractChange;
  consumerImpact: "confirmed_usage" | "not_found" | "not_analyzed";
  references: ConsumerReference[];
};

export type ImpactReport = {
  changes: ContractChange[];
  consumers: ConsumerReference[];
  impacts: ChangeImpact[];
  unmatchedBreakingChanges: ContractChange[];
  limitations: string[];
};
