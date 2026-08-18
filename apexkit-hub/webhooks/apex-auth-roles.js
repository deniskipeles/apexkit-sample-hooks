export const __fileMetadata__ = {
  "id": 1,
  "name": "apex-auth-roles",
  "extension": "js",
  "target_collection": null,
  "type": "webhook",
  "path": "./webhooks/",
  "trigger_type": "manual",
  "active": true,
  "visibility": "private"
};

import { getUsersHelper } from "@/custom/getUsers";
export default async function (req) {
    const users = getUsersHelper();
    return new Response({
        users,
        roles: ["user", "admin", "editor"]
    });
}