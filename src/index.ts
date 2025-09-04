#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import fastify from "fastify";
import { z } from "zod";

interface Memory {
  id: string;
  content: string;
  userId: string;
  timestamp: Date;
}

class QuinnMemoryServer {
  private server: Server;
  private memories: Memory[] = [];
  private fastifyServer: any;

  constructor() {
    this.server = new Server(
      {
        name: "quinn-memory-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
    this.setupFastifyServer();
  }

  private setupToolHandlers() {
    // Add memory tool
    this.server.setRequestHandler("tools/list", async () => ({
      tools: [
        {
          name: "add-memory",
          description: "Add a new memory for a user",
          inputSchema: {
            type: "object",
            properties: {
              content: {
                type: "string",
                description: "The content to store in memory",
              },
              userId: {
                type: "string",
                description: "User ID for memory storage. Defaults to 'quinn_may' if not provided.",
                default: "quinn_may",
              },
            },
            required: ["content"],
          },
        },
        {
          name: "search-memories",
          description: "Search through stored memories for a user",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "The search query to find relevant memories",
              },
              userId: {
                type: "string",
                description: "User ID for memory storage. Defaults to 'quinn_may' if not provided.",
                default: "quinn_may",
              },
            },
            required: ["query"],
          },
        },
      ],
    }));

    // Tool execution handler
    this.server.setRequestHandler("tools/call", async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === "add-memory") {
          return await this.addMemory(args);
        } else if (name === "search-memories") {
          return await this.searchMemories(args);
        } else {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${name}`
          );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error}`
        );
      }
    });
  }

  private async addMemory(args: any) {
    const schema = z.object({
      content: z.string(),
      userId: z.string().default("quinn_may"),
    });

    const { content, userId } = schema.parse(args);
    
    const memory: Memory = {
      id: Math.random().toString(36).substring(2, 15),
      content,
      userId,
      timestamp: new Date(),
    };

    this.memories.push(memory);

    return {
      content: [
        {
          type: "text",
          text: `Memory added successfully for user ${userId}. Memory ID: ${memory.id}`,
        },
      ],
    };
  }

  private async searchMemories(args: any) {
    const schema = z.object({
      query: z.string(),
      userId: z.string().default("quinn_may"),
    });

    const { query, userId } = schema.parse(args);

    const userMemories = this.memories.filter(m => m.userId === userId);
    const relevantMemories = userMemories.filter(memory =>
      memory.content.toLowerCase().includes(query.toLowerCase())
    );

    const results = relevantMemories
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 10)
      .map(memory => ({
        id: memory.id,
        content: memory.content,
        timestamp: memory.timestamp.toISOString(),
      }));

    return {
      content: [
        {
          type: "text",
          text: `Found ${results.length} memories for query "${query}":\n\n${results
            .map((r, i) => `${i + 1}. [${r.timestamp}] ${r.content}`)
            .join("\n")}`,
        },
      ],
    };
  }

  private async setupFastifyServer() {
    this.fastifyServer = fastify({
      logger: true,
    });

    // CORS configuration for MCP
    await this.fastifyServer.register(require('@fastify/cors'), {
      origin: true,
      credentials: true,
      exposedHeaders: ['Mcp-Session-Id'],
    });

    // Bearer token authentication middleware
    this.fastifyServer.addHook('preHandler', async (request: any, reply: any) => {
      if (request.url === '/health') {
        return; // Skip auth for health check
      }

      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.code(401).send({ error: 'Bearer token required' });
        return;
      }

      const token = authHeader.substring(7);
      const validToken = process.env.MCP_BEARER_TOKEN || 'default-token-change-me';
      
      if (token !== validToken) {
        reply.code(401).send({ error: 'Invalid bearer token' });
        return;
      }
    });

    // Health check endpoint
    this.fastifyServer.get('/health', async () => {
      return { status: 'healthy', timestamp: new Date().toISOString() };
    });

    // MCP HTTP transport endpoint
    this.fastifyServer.post('/mcp', async (request: any, reply: any) => {
      try {
        const sessionId = request.headers['mcp-session-id'] || 'stateless';
        
        // Set session ID header for response
        reply.header('Mcp-Session-Id', sessionId);
        reply.header('Content-Type', 'application/json');

        // Process MCP request through the server
        const response = await this.server.request(request.body);
        return response;
      } catch (error) {
        console.error('MCP request error:', error);
        reply.code(500).send({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal error",
            data: error instanceof Error ? error.message : String(error),
          },
          id: request.body?.id || null,
        });
      }
    });

    // Start server
    const port = parseInt(process.env.PORT || '3000');
    const host = process.env.HOST || '0.0.0.0';
    
    try {
      await this.fastifyServer.listen({ port, host });
      console.log(`Quinn Memory MCP Server running on ${host}:${port}`);
      console.log(`Health check: http://${host}:${port}/health`);
      console.log(`MCP endpoint: http://${host}:${port}/mcp`);
      console.log('Bearer token auth required for MCP endpoint');
    } catch (err) {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
  }

  async start() {
    // Server is started in setupFastifyServer
  }
}

// Start the server
const memoryServer = new QuinnMemoryServer();
memoryServer.start().catch(console.error);