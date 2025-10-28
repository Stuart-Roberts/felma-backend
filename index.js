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

// Headline generation rules (v2.2 - Cost Efficiency with Specific Verbs)
const HEADLINE_RULES = `# Frustrations → Ideas Headline Standard  
**Version:** v2.2 (Cost Efficiency with Specific Effect Verbs)

## Your Task
Convert raw user input into a standardized headline following this exact format.
This system works across ALL workplaces: manufacturing, education, healthcare, retail, government, services.

## Structure
\`[Cause / Concern] – [Effect (Verb or Adjective)] [Parameter]\`

## Rules
1. **Two-Word Limit After the Hyphen**: Effect + Parameter must be EXACTLY 2 words
2. **Max 5-6 words total** (≈ 3 + 2 structure)
3. Use en-dash with spaces: " – "
4. **Title Case** main words; no punctuation at end
5. Keep tone factual and objective (no "Kills", "Destroys")
6. **Preserve specific context words** - Don't drop important qualifiers (e.g., "Material Deliveries" not just "Deliveries")
7. If uncertain about effect or parameter, use: "– (to review)"

## CRITICAL: Detect Improvement Ideas
If input contains "Add", "Introduce", "Implement", "Create", "Build" - this is a SOLUTION, not a problem!
- ❌ WRONG: "Tool Board Missing"
- ✅ RIGHT: "Tool Board Proposed – Boosts Efficiency"

## Universal Parameter Library (Choose ONE)

### 1. Safety & Wellbeing
Physical safety + mental wellbeing for workers, learners, patients, customers, public.
Includes: Hazards, injuries, ergonomics, PPE, stress, burnout, workload pressure, safeguarding systems.
Use when: Physical harm risk OR mental wellbeing at risk.

### 2. Quality  
Correctness, consistency, standards, effectiveness of outputs/outcomes.
Manufacturing: Product consistency, defect rates, batch variation.
Education: Teaching effectiveness, learning outcomes, assessment accuracy.
Healthcare: Care standards, treatment outcomes, clinical protocols.
Services: Work accuracy, deliverable standards, error rates.
Use when: Standards, correctness, outcomes affected.

### 3. Compliance
Legal obligations, regulatory requirements, audit readiness, policy adherence.
Manufacturing: ISO, FDA, CAPA, traceability.
Education: Ofsted, safeguarding policies, DfE guidelines.
Healthcare: CQC, clinical governance, GDPR.
Government: Statutory obligations, FOI, transparency.
Use when: Legal/regulatory risk or audit gaps.

### 4. Timely Delivery
Timing, speed, throughput, availability, schedule adherence.
Can use proxies: "Delays Production", "Delays Work", "Slows Process".
Manufacturing: Production throughput, dispatch timing, schedule adherence.
Education: Curriculum pace, assessment deadlines.
Healthcare: Appointment availability, waiting times.
Services: Project deadlines, turnaround times, SLA compliance.
Use when: Timing, speed, or availability issues.

### 5. Cost Efficiency
Utilization of money, materials, and resources - both reducing waste AND optimizing use.
Direct, visible financial impact: spending, bills, materials, supplies, resource consumption.

What counts as Cost Efficiency:
- Bills and invoices (energy, utilities, services) - "Energy bills increased 40%" → Cost Efficiency
- Direct spending (overtime due to planning failures, budget overruns) - "Overtime costs doubled" → Cost Efficiency
- Material waste (thrown away, expired, scrapped) - "Throw away 15% ingredients" → Cost Efficiency
- Supply waste (overordering, stock loss)
- Resource misuse with direct £/$ impact (time waste, walking, motion)
- Process inefficiencies that directly waste money/materials

What is NOT Cost Efficiency (even though it has cost implications):
- Rework due to defects → Quality (root cause)
- Delays causing penalties → Timely Delivery (root cause)
- Safety incidents → Safety & Wellbeing (root cause)
- Staff turnover → Morale (root cause)

KEY RULE: If you can immediately put a £/$ figure on waste, it's Cost Efficiency.
If cost is a CONSEQUENCE of another problem, use the root cause parameter.

Manufacturing: Material waste, energy bills, supply costs, scrap reduction.
Education: Budget waste, utility bills, resource overuse.
Healthcare: Supply waste, energy costs, unnecessary spending.
Services: Operational waste, utility costs, material costs.
Government: Taxpayer money waste, budget inefficiency.

Use when: Direct financial or resource waste/inefficiency that you can immediately quantify in £/$.

### 6. Morale
Team motivation, energy, fairness, recognition, working culture.
Includes: Motivation, fairness, recognition, team engagement, workplace culture.
Note: Mental wellbeing can go here OR in Safety & Wellbeing - both valid.
Use when: Motivation, fairness, recognition, or team culture affected.

### 7. Customer Experience
External stakeholder perception, trust, reputation, satisfaction.
WHO are customers?: End users, patients, students, parents, citizens, clients - anyone OUTSIDE the organization.
Manufacturing: End users, distributors, brand perception.
Education: Students, parents, community, inspectors.
Healthcare: Patients, families, commissioners.
Government: Citizens, service users, public trust.
Use when: External perception, reputation, or stakeholder trust affected.
KEY: Use this for PERCEPTION issues, not internal quality standards.

## Parameter Priority
1. Safety & Wellbeing - if physical/mental harm risk (systemic, not active incidents)
2. Compliance - if legal/regulatory risk (process gaps, not active breaches)
3. Customer Experience - if external perception/reputation affected
4. Quality vs Timely Delivery - Quality = WHAT (correctness), Timely Delivery = WHEN (speed)
5. Cost Efficiency - direct financial/resource waste (can put £/$ on it immediately)
6. Morale - motivation/fairness (when not wellbeing issue)

## Effect Words (Use These)
**For improvements:** Raises, Boosts, Enhances, Reduces, Lowers, Speeds, Improves
**For problems:** Risk, Issue, Variation, Hazard, Defect
**For impacts:** Damages (Reputation/Experience), Delays (Production/Work), Wastes (Time/Resources)

**For Cost Efficiency - PREFER SPECIFIC VERBS (most important):**
- "Increases Costs" - when bills/spending go up
- "Wastes Money" - when direct financial waste
- "Wastes Resources" - when materials/supplies wasted
- "Wastes Time" - when time/labor wasted
- "Reduces Efficiency" - when process inefficiency costs money

Examples:
- "Energy bills increased 40%" → "Energy Bills Increased – Increases Costs"
- "Overtime doubled due to planning" → "Overtime Costs Doubled – Wastes Money"
- "Throw away 15% ingredients" → "Ingredient Waste – Wastes Resources"
- "Walk 200m to get supplies daily, wastes 15 min" → "Supply Distance Long – Wastes Time"

If specific verb unclear, use:
- "Cost Efficiency Problem" or "Cost Efficiency Risk"

Only if completely uncertain:
- "Cost Efficiency" (parameter alone)

**Preferred combinations:**
- "Raises Quality" (not "Improves Quality")
- "Lowers Morale"
- "Damages Reputation" or "Damages Experience"
- "Delays Production" or "Delays Work"
- "Increases Costs" or "Wastes Money/Time/Resources" (for Cost Efficiency)

## Multi-Domain Examples

### Manufacturing:
- "Replace conical flasks they're slippery and hard to read" → "Conical Flasks Slippery – Quality Risk"
- "Raw material deliveries arrive late" → "Late Material Deliveries – Delays Production"
- "No recognition for overtime work" → "Overtime Recognition Missing – Lowers Morale"
- "Workload during peak causing stress" → "Peak Season Workload – Wellbeing Risk"

### Education:
- "Run classroom observations to share effective practice" → "Classroom Observations Proposed – Raises Quality"
- "Parents complain about inconsistent homework marking" → "Inconsistent Homework Marking – Damages Reputation"
- "Break room tables too small" → "Break Room Tables Small – Lowers Morale"
- "Teacher workload unsustainable causing burnout" → "Teacher Workload Unsustainable – Wellbeing Risk"

### Healthcare:
- "Patient records scattered across 3 systems" → "Patient Records Scattered – Compliance Risk"
- "Waiting room chairs uncomfortable for elderly" → "Waiting Room Chairs Uncomfortable – Damages Experience"

### Retail/Services:
- "Customers receive incorrect invoices 10% of time" → "Incorrect Invoices – Damages Reputation"
- "Energy bills increased 40% from machines left on" → "Energy Bills Increased – Increases Costs"

### Government:
- "FOI requests going overdue regularly" → "FOI Requests Overdue – Compliance Risk"
- "Citizens complain about confusing online forms" → "Online Forms Confusing – Damages Experience"

## CRITICAL GUARDRAILS
🚨 If input contains ACTIVE INCIDENTS (not systemic risks), output: "(Escalate - Not for Felma)"

Red flags: Named person + harm words ("John bleeding", "Peter injured"), active breaches ("we shipped without testing"), emergency language ("happening now", "urgent danger").

Examples:
- ❌ "John's finger caught in machine, bleeding" → "(Escalate - Not for Felma)"
- ✅ "Machine guard keeps failing, could trap fingers" → "Machine Guard Failing – Safety Risk"
- ❌ "We shipped product without required testing" → "(Escalate - Not for Felma)"  
- ✅ "Testing documentation often incomplete" → "Testing Documentation Incomplete – Compliance Risk"

## Output Instructions
- Output ONLY the headline, nothing else
- Never wrap the headline in quotation marks - output directly without quotes
- Never exceed 2 words after the hyphen
- If uncertain: use "– (to review)"
- Preserve specific context words (don't over-shorten)
- Detect improvement ideas correctly (don't say "Missing" when they're proposing to add it)
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
    let headline = data.choices[0].message.content.trim();
    
    // Remove any wrapping quotes (single or double)
    headline = headline.replace(/^["']|["']$/g, '');
    
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
