import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createClient } from "@supabase/supabase-js";
import admin from "firebase-admin";
import cors from "cors";
import dotenv from "dotenv";
import firebaseConfig from "./firebase-applet-config.json" with { type: "json" };

dotenv.config();

// Initialize Firebase Admin for Authentication
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.error("CRITICAL: Supabase credentials missing. Please set SUPABASE_URL and SUPABASE_ANON_KEY in environment variables.");
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(cors());

  // Middleware to verify Firebase Auth Token
  const authenticateToken = async (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: "Unauthorized: No token provided" });
    }

    try {
      const decodedToken = await admin.auth().verifyIdToken(token);
      req.user = decodedToken;
      next();
    } catch (err) {
      console.error("Token verification error:", err);
      return res.status(403).json({ error: "Forbidden: Invalid token" });
    }
  };

  // API Routes
  app.get("/api/supabase-check", async (req, res) => {
    try {
      const { data, error } = await supabase.from("user_settings").select("count").limit(1);
      res.json({ connected: !error, error: error ? error : null });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
  
  // Settings
  app.get("/api/settings", authenticateToken, async (req: any, res) => {
    try {
      const { uid } = req.user;
      const { data, error } = await supabase
        .from("user_settings")
        .select("*")
        .eq("uid", uid)
        .single();

      if (error && error.code === 'PGRST116') {
        // No results, insert default settings
        const { data: newData, error: insertError } = await supabase
          .from("user_settings")
          .insert([{ uid }])
          .select()
          .single();
        
        if (insertError) {
          console.error("Settings INSERT error:", JSON.stringify(insertError, null, 2));
          throw insertError;
        }
        return res.json(newData);
      }
      
      if (error) {
        console.error("Settings GET error details:", JSON.stringify(error, null, 2));
        throw error;
      }
      res.json(data);
    } catch (err) {
      console.error("Settings GET catch error:", err);
      res.status(500).json({ error: "Internal server error: " + (err instanceof Error ? err.message : String(err)) });
    }
  });

  app.put("/api/settings", authenticateToken, async (req: any, res) => {
    try {
      const { uid } = req.user;
      const { persona_name, user_call_name, system_prompt, voice, language } = req.body;
      
      const { data, error } = await supabase
        .from("user_settings")
        .upsert({
          uid,
          persona_name,
          user_call_name,
          system_prompt,
          voice,
          language
        })
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err) {
      console.error("Settings PUT error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Memories
  app.get("/api/memories", authenticateToken, async (req: any, res) => {
    try {
      const { uid } = req.user;
      const { data, error } = await supabase
        .from("user_memories")
        .select("*")
        .eq("uid", uid)
        .order("created_at", { ascending: false });

      if (error) throw error;
      res.json(data);
    } catch (err) {
      console.error("Memories GET error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.post("/api/memories", authenticateToken, async (req: any, res) => {
    try {
      const { uid } = req.user;
      const { content, type } = req.body;
      
      const { data, error } = await supabase
        .from("user_memories")
        .insert([{ uid, content, type }])
        .select()
        .single();

      if (error) throw error;
      res.json(data);
    } catch (err) {
      console.error("Memories POST error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  app.delete("/api/memories/:id", authenticateToken, async (req: any, res) => {
    try {
      const { uid } = req.user;
      const { id } = req.params;
      
      const { error } = await supabase
        .from("user_memories")
        .delete()
        .eq("id", id)
        .eq("uid", uid);

      if (error) throw error;
      res.json({ status: "success" });
    } catch (err) {
      console.error("Memories DELETE error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Storage Example Endpoint (if user wants to upload something)
  app.post("/api/upload", authenticateToken, async (req: any, res) => {
     // This is a placeholder for future storage implementation if needed
     res.status(501).json({ error: "Storage endpoint not fully implemented. Requires multipart/form-data handling." });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Supabase integrated for DB storage.`);
  });
}

startServer();
