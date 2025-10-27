// Felma backend - Express + Supabase + GPT Headline Generation
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

// OpenAI API key from environment
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Headline generation rules (v1.3)
const HEADLINE_RULES = `# Frustrations → Ideas Headline Standard  
**Version:** v1.3 (Concise Two-Word Rule)  

## Your Task
Convert raw user input into a standardized headline following this exact format:

## Structure
\`[Cause / Concern] – [Effect (Verb or Adjective)] [Parameter]\`

## Rules
1. **Two-Word Limit After the Hyphen**: Effect + Parameter must be EXACTLY 2 words
2. **Max 5-6 words total** (≈ 3 + 2 structure)
3. Use en-dash with spaces: " – "
4. **Title Case** main words; no punctuation at end
5. Keep tone factual and objective (no "Kills", "Destroys" - use "Lowers", "Reduces")
6. If uncertain about effect or parameter, use: "– (to review)"

## Parameter Library (Choose ONE)
- **Safety** - Physical/procedural safety, ergonomics, PPE
- **Quality** - Product/process correctness, consistency
- **Compliance** - Legal/procedural adherence, audit
- **Delivery** - Timing, throughput, flow
- **Value** - Cost, waste, efficiency, profitability
- **Morale** - Team energy, fairness, motivation
- **Experience** - Customer/user perception, reputation

## Effect Words
**Verbs** (for improvements): Improve, Reduce, Raise, Lower, Boost, Enhance, Speed, Streamline
**Adjectives** (for problems): Risk, Issue, Variation, Delay, Barrier, Hazard, Defect

## Examples
| Input | Headline |
|-------|----------|
| Replace conical flasks (non-slip, better markings) | Conical Flasks Slippery – Quality Risk |
| Get gloves for smaller hand sizes | Small Gloves Lacking – Safety Risk |
| Clocking policy unfair | Clocking Policy Unfair – Lowers Morale |
| Fix noisy chair casters | Chair Casters Noisy – Disrupts Focus |
| Add team break area | No Team Break Area – Raise Morale |
| Mixing blades inconsistent | Mixing Blades Inconsistent – Quality Variation |
| Build FIFO rack feed | FIFO Rack Missing – Flow Inefficient |
| CAPA reports go overdue | CAPA Reports Overdue – Compliance Risk |

## Important
- Output ONLY the headline, nothing else
- If multiple parameters apply or effect unclear: use "– (to review)"
- Never exceed 2 words after the hyphen
`;

// Generate headline using GPT-3.5 Turbo
async function generateHeadline(content) {
  if (!content || content.trim().length === 0) {
    return 'Untitled – (to review)';
  }

  // If no API key, return fallback
  if (!OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY not set, using fallback headline');
    const words = content.split(' ').slice(0, 3).join(' ');
    return `${words} – (to review)`;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: HEADLINE_RULES
          },
          {
            role: 'user',
            content: `Convert this to a headline: ${content}`
          }
        ],
        temperature: 0.3,
        max_tokens: 30
      })
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('GPT API error:', error);
      throw new Error('API call failed');
    }

    const data = await response.json();
    const headline = data.choices[0].message.content.trim();
    
    // Validate it looks like a headline
    if (headline.includes(' – ') || headline.includes(' - ')) {
      console.log('Generated headline:', headline);
      return headline;
    }
    
    // Fallback if GPT didn't follow format
    throw new Error('Invalid format returned');
    
  } catch (error) {
    console.error('Headline generation error:', error);
    // Fallback: simple extraction
    const words = content.split(' ').slice(0, 3).join(' ');
    return `${words} – (to review)`;
  }
}

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

// CREATE ITEM - Generate headline and accept ratings during creation
app.post('/api/items', async (req, res) => {
  try {
    const content = req.body.content || req.body.transcript || '';
    const { customer_impact, team_energy, frequency, ease } = req.body;
    
    // Generate headline from content
    const headline = await generateHeadline(content);
    console.log('Content:', content);
    console.log('Generated headline:', headline);
    
    // Check if ratings were provided
    const hasRatings = customer_impact && team_energy && frequency && ease;
    
    const itemData = {
      ...req.body,
      headline,  // Add generated headline
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
    
    console.log('Item created:', { id: data.id, headline: data.headline, stage: data.stage, hasRatings });
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

// UPDATE HEADLINE - Allow users to edit the headline
app.post('/api/items/:id/headline', async (req, res) => {
  try {
    const { headline } = req.body;
    
    if (!headline || headline.trim().length === 0) {
      return res.status(400).json({ error: 'Headline cannot be empty' });
    }
    
    // Validate format (must contain separator)
    if (!headline.includes(' – ') && !headline.includes(' - ')) {
      return res.status(400).json({ 
        error: 'Use format: "Cause – Effect Parameter" (with spaces around –)' 
      });
    }
    
    // Check 2-word limit after separator
    const parts = headline.split(/\s+[–\-]\s+/);
    if (parts.length !== 2) {
      return res.status(400).json({ 
        error: 'Must have exactly one separator (–)' 
      });
    }
    
    const effectPart = parts[1].trim();
    const effectWords = effectPart.split(/\s+/);
    
    // Allow "(to review)" as exception
    if (effectPart !== '(to review)' && effectWords.length > 2) {
      return res.status(400).json({ 
        error: 'Effect must be max 2 words (e.g., "Quality Risk", "Raise Morale")' 
      });
    }
    
    console.log('Updating headline:', { id: req.params.id, headline });

    const { data, error } = await supabase
      .from('items')
      .update({ headline: headline.trim() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    
    console.log('Headline updated successfully');
    res.json(data);
  } catch (error) {
    console.error('Error updating headline:', error);
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
  console.log('OpenAI API key:', OPENAI_API_KEY ? 'configured ✓' : 'missing ✗');
});
