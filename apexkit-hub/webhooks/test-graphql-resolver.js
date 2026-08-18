export const __fileMetadata__ = {
  "id": 4,
  "name": "test-graphql-resolver",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "graphql",
  "active": true,
  "visibility": "private"
};

export const graphql = {
    parent: "Query",
    name: "hello",
    args: { name: "String!" },
    returnType: "JSON"
};

export default async function (req) {
    const res = await $apex.collection("docs").list();
    return { greet: `Hello, ${req.args.name}!`, res };
}