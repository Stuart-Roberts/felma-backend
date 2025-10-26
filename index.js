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

// Helper function to calculate priority rank
function calculatePriorityRank(ci, te, fr, ea) {
  const a = 0.57 * ci + 0.43 * te;
  const b = 0.6 * fr + 0.4 * ea;
  return Math.round(a * b);
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// LIST ITEMS - Frontend calls this as /api/list
app.get('/api/list', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('items')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    
    // Frontend expects { items: [...] } format
    res.json({ items: data || [] });
  } catch (error) {
    console.error('Error fetching list:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all items - alternative endpoint
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

// CREATE ITEM - Accept ratings during creation and advance to stage 3 if ratings provided
app.post('/api/items', async (req, res) => {
  try {
    const content = req.body.content || req.body.transcript || '';
    const { customer_impact, team_energy, frequency, ease } = req.body;
    
    // Check if ratings were provided
    const hasRatings = customer_impact && team_energy && frequency && ease;
    
    const itemData = {
      ...req.body,
      stage: hasRatings ? 3 : 1,  // If ratings provided, skip to stage 3 (Involve)
      stage_1_capture: content
    };

    // If ratings provided, calculate priority rank
    if (hasRatings) {
      const ci = Number(customer_impact) || 0;
      const te = Number(team_energy) || 0;
      const fr = Number(frequency) || 0;
      const ea = Number(ease) || 0;
      
      const priority_rank = calculatePriorityRank(ci, te, fr, ea);
      itemData.priority_rank = priority_rank;
      itemData.customer_impact = ci;
      itemData.team_energy = te;
      itemData.frequency = fr;
      itemData.ease = ea;
    }

    const { data, error } = await supabase
      .from('items')
      .insert([itemData])
      .select()
      .single();

    if (error) throw error;
    
    console.log('Item created:', { id: data.id, stage: data.stage, hasRatings });
    res.status(201).json(data);
  } catch (error) {
    console.error('Error creating item:', error);
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

// UPDATE RATINGS - Complete Clarify stage and advance to stage 3 (Involve)
app.post('/api/items/:id/ratings', async (req, res) => {
  try {
    const { customer_impact, team_energy, frequency, ease } = req.body;
    
    const ci = Number(customer_impact) || 0;
    const te = Number(team_energy) || 0;
    const fr = Number(frequency) || 0;
    const ea = Number(ease) || 0;
    
    const priority_rank = calculatePriorityRank(ci, te, fr, ea);

    // After ratings saved, advance to stage 3 (Involve)
    const updateData = {
      customer_impact: ci,
      team_energy: te,
      frequency: fr,
      ease: ea,
      priority_rank,
      stage: 3  // Clarify (stage 2) is now complete, advance to Involve
    };

    console.log('Updating ratings and advancing to stage 3:', { id: req.params.id, priority_rank });

    const { data, error } = await supabase
      .from('items')
      .update(updateData)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    
    console.log('Ratings saved, stage now:', data.stage);
    res.json(data);
  } catch (error) {
    console.error('Error updating ratings:', error);
    res.status(500).json({ error: error.message });
  }
});

// UPDATE STAGE - Save note to current stage and advance to next stage
app.post('/api/items/:id/stage', async (req, res) => {
  try {
    const { id } = req.params;
    const { stage, note } = req.body;

    console.log("Stage update request:", { id, stage, note });

    // Validate stage number
    if (!stage || stage < 1 || stage > 9) {
      return res.status(400).json({ error: "Invalid stage number" });
    }

    // Map stage numbers to their column names
    const fieldMap = {
      1: "stage_1_capture",
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

    // Determine next stage (don't advance past stage 9)
    const nextStage = stage < 9 ? stage + 1 : 9;
    
    const updateData = {
      [fieldToUpdate]: note,
      stage: nextStage
    };

    console.log("Updating stage:", updateData);

    const { data, error } = await supabase
      .from("items")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    console.log("Stage updated successfully, new stage:", data.stage);
    res.json(data);
  } catch (error) {
    console.error("Stage update error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
