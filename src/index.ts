import { Type } from "@sinclair/typebox";

/**
 * Plugin mínimo de OpenClaw.
 *
 * - Registra una tool OPCIONAL (opt-in).
 * - Si NO la allowlisteás en openclaw.json, no aparece para el modelo.
 */
export default function register(api: any) {
  // Leer config del plugin (si existe)
  const cfg =
    api.config?.plugins?.entries?.["example-optional-tools"]?.config ?? {};
  const defaultName = String(cfg.defaultName ?? "mundo");

  api.registerTool(
    {
      name: "hello_optional",
      description:
        "Devuelve un saludo. Ejemplo de tool opcional (solo aparece si la allowlisteás).",
      parameters: Type.Object({
        name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
      }),
      async execute(_id: string, params: any) {
        const name = String(params?.name ?? defaultName);
        return {
          content: [{ type: "text", text: `Hola, ${name}! (tool opcional)` }],
        };
      },
    },
    { optional: true },
  );
}
