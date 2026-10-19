import { POST as handlePost, GET as handleGet } from "./handler";

export function POST(request: Request) { return handlePost(request); }
export function GET() { return handleGet(); }
