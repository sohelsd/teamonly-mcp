# Runs the TeamOnly MCP server from the published npm package (stdio).
FROM node:22-slim
RUN npm install -g teamonly@0.8.0
ENTRYPOINT ["teamonly", "mcp"]
