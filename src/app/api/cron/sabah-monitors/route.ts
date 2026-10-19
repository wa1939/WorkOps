import { GET as handleGet, POST as handlePost } from "./handler";

export const maxDuration = 60;

export function GET(request: Request) { return handleGet(request); }
export function POST(request: Request) { return handlePost(request); }
