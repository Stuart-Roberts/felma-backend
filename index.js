// Felma backend - Express + Supabase
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get all items
app.get('/api/items', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single item
app.get('/api/items/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching item:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new item
app.post('/api/items', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('items')
      .insert([req.body])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('Error creating item:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update stage and save note to CURRENT stage column
app.post('/api/items/:id/stage', async (req, res) => {
  try {
    const { id } = req.params;
    const { stage, note } = req.body;

    console.log("Stage update:", { id, stage, note });

    // Validate stage number
    if (!stage || stage < 3 || stage > 9) {
      return res.status(400).json({ error: "Invalid stage number" });
    }

    // Map stage numbers to CURRENT stage column names
    const fieldMap = {
      3: "stage_3_involve",
      4: "stage_4_choose",
      5: "stage_5_prepare",
      6: "stage_6_act",
      7: "stage_7_learn",
      8: "stage_8_recognise",
      9: "stage_9_share_story"
    };

    const fieldToUpdate = fieldMap[stage];

    if (!fieldToUpdate) {
      return res.status(400).json({ error: "Invalid stage for note saving" });
    }

    // Build update object
    const updateData = {
      stage: stage,
      [fieldToUpdate]: note
    };

    console.log("Updating:", updateData);

    // Update in database
    const { data, error } = await supabase
      .from("items")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error("Stage update error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Update ratings
app.post('/api/items/:id/ratings', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('items')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error updating ratings:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
