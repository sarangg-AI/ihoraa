import { analyze, BadRequest, parseScanRequest } from "@/lib/analyze";
import { rateLimited } from "@/lib/ratelimit";

// Scans the uploaded files and returns masked findings plus a preview of the
// fix. Nothing is stored: the files only live in memory for this request.
export async function POST(request: Request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  try {
    const req = parseScanRequest(await request.json());
    const { result } = analyze(req);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof BadRequest) return Response.json({ error: err.message }, { status: 400 });
    if (err instanceof SyntaxError) return Response.json({ error: "The upload could not be read." }, { status: 400 });
    return Response.json({ error: "Something went wrong while scanning." }, { status: 500 });
  }
}
