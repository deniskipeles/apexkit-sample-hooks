/** @type {import("../apexkit").FileMetadata} */
export const __fileMetadata__ = {
  "name": "test-graphql",
  "extension": "ts",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "graphql",
  "active": true,
  "visibility": "private"
};

/**
 * Dynamic GraphQL Field Resolver: test-graphql
 */
export const graphql = {
  parent: "Query",
  name: "test_graphql",
  args: {
    query: "String"
  },
  returnType: "JSON"
};

export default async function (input) {
  const search = input.query || "";
  return {
    status: "ok",
    query: search,
    timestamp: new Date().toISOString()
  };
}
