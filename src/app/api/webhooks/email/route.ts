import { POST as handlePost } from "./handler";

export function POST(request: Request) { return handlePost(request); }
