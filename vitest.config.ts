import { defineConfig } from "vitest/config";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsConfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Les suites qui montent la chaîne repositories -> "@/db" paient un coût
    // d'import à froid qui tombe dans le timeout du PREMIER test du fichier
    // (relatedDiscovery, competitorDiscovery... via le stub cloudflare:workers).
    // Le défaut de 5 s était franchi de façon intermittente à froid, jamais à
    // chaud. Une marge globale évite d'éparpiller des timeouts au cas par cas ;
    // un test réellement bloqué échoue toujours, simplement plus tard.
    testTimeout: 20000,
    restoreMocks: true,
    clearMocks: true,
  },
});
