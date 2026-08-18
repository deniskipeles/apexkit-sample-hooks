export const __fileMetadata__ = {
  "id": 112,
  "name": "getUsers",
  "extension": "js",
  "target_collection": null,
  "type": "custom:module",
  "path": "./modules/custom/",
  "trigger_type": "manually",
  "active": true,
  "visibility": "private"
};

/**
 * Custom Helper Module: getUsers
 * Import in webhooks via: import { helper } from "@/custom/getUsers"
 */
export function getUsersHelper() {
  // test file is here should have commited
  // const users = $db.records.list("users",{})
  return "Hello from getUsers!";
}