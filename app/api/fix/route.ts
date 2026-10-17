import { analyze, BadRequest, parseScanRequest } from "@/lib/analyze";

// Returns the full contents of every new or changed file. The browser merges
// them with the original upload into the secured zip. This response contains
// the real keys (inside .env), so it is never cached or logged.
export async function POST(request: Request) {
  try {
    const req = parseScanRequest(await request.json());
    const { fix } = analyze(req);
    return Response.json({ files: fix.files }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof BadRequest) return Response.json({ error: err.message }, { status: 400 });
    if (err instanceof SyntaxError) return Response.json({ error: "The upload could not be read." }, { status: 400 });
    return Response.json({ error: "Something went wrong while securing your project." }, { status: 500 });
  }
}
