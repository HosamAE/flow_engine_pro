# 📑 ODOO FLOW ENGINE PRO (V1.5) - Technical Specification & Implementation Plan

> [!NOTE]
> This document outlines the proposed architecture and implementation strategy for the **Odoo Flow Engine Pro (V1.5)**, merging the original specifications with advanced **Enterprise-Grade** architectural patterns (Spatial Hashing, Deltas, Fillet Algorithms, and ACL Security) for a robust Odoo 17/18/19 implementation.

---

## 1. 🏗️ THE ENGINE CORE: COORDINATE MATRIX & PERFORMANCE

### 1.1 Canvas Fundamentals & Rendering Optimization
- **Infinite Grid Dynamics**: Background uses a "Coordinate Plane" (X, Y). Options: Dots (Fine scale), Grid (Classic), or Blank. Selectable via Native Odoo Configuration.
- **Zero-Lag Performance**: Powered by HTML5 Canvas API + `requestAnimationFrame` for a locked 60fps.
- **Spatial Hashing Logic (Advanced Performance)**: To handle thousands of elements without lag, the canvas space is divided into invisible grid squares ("Chunks"). Only elements within visible or adjacent chunks are processed during panning/zooming, converting rendering overhead from O(N) to O(1) in the viewport.
- **Dirty-Rect Strategy**: Only recalculates the bounding box of moving elements to save CPU cycles.
- **Float64 Precision**: Prevents "Sub-pixel jitter" during extreme zooming.

### 1.2 Selection & Batch Logic (Center-Point Mastery)
- **The Rule of the Center**: Every object (Node/Edge) is indexed by its calculated geometric center.
- **Marquee Selection (Windows-Style)**: When in "Arrow/Select Mode", clicking and dragging creates a selection marquee. Any object whose Center Point falls within the marquee is added to the "Active Selection Group".
- **Batch Operations**: Cut, Copy, Paste, and Delete apply to the entire Active Group simultaneously.

---

## 2. 🛡️ THE VECTOR ENGINE: NODES & EDGES

### 2.1 Shape Mechanics (The Nodes)
- **Primitives**: Oval (Start/End), Rectangle (Process), Diamond (Decision), Parallelogram (I/O Data), Speech Bubble (Comments).
- **Collision Detection (Hard Constraint)**: Basic shapes cannot overlap.
- **Visual Feedback**: A Red Glow (Halo) appears if a node enters another's proximity.
- **Auto-Repel**: On drop, the node snaps to the nearest available grid intersection to avoid overlap.
- **Annotation Exception**: Comment bubbles use a higher Z-index and can overlap shapes for labeling.

### 2.2 Smart Orthogonal Routing (The Edges)
- **Point-Based DNA**: Every arrow is a linked list of coordinates.
- **The Rule of Two (Line Survival)**: A line must have at least 2 points to exist. If a point is deleted from a 3-point line, the segment bridges the gap. If reduced to 1 point, it is instantly purged from the DB to prevent "Ghost Data".
- **Dynamic Snapping (Magnetism)**: Arrows "slide" along node borders to find the closest of 4 ports (N, S, E, W).
- **Fillet Algorithm (Advanced Aesthetics)**: Native implementation using `arcTo()` mapping on Canvas to draw precise 10px rounded corners on all 90° orthogonal turns, providing a clean "Visio-like" professional look dynamically.

---

## 3. 🖥️ INTERACTION & NATIVE UX SUITE

### 3.1 The Intelligent Command Center
- **Interaction Mode Toggle**: Switches between Edit Mode (Pen Icon) and Navigation/Select Mode (Arrow Icon).
- **State Management (Deltas)**: The Undo/Redo stack relies on the **Command Pattern**. Instead of deep-copying massive JSON states, the system only stores the "Delta" (the exact change, e.g., "Node A moved +10px"). This totally eliminates memory leaks holding up RAM over long sessions.
- **System Bar Actions**: Clipboard commands (✂️📋📝🗑️), Snapshot exporter, Magnetic Snap toggle.

### 3.2 Navigation & Sidebar
- **Native Odoo Sidebar**: A 100% standard Odoo Tree/List view beside the canvas. 
- **Mini-map**: 1:10 scale transparent overlay with a red viewport tracker.

---

## 4. 🧠 DATA, SEARCH & AI READY

### 4.1 Hybrid Storage Strategy
- **JSON Blob**: Primary source for UI rendering (Positions, Waypoints, States). This is stored as a `JSON` field for lightning-fast frontend loading.
- **SQL Deconstruction**: Background sync into `workflow.node` and `workflow.edge` models for Odoo's Global Search capabilities.
- **Search & Pulse**: Searching a node name triggers: Record Open -> Canvas Pan -> 3-Second Yellow Pulse Animation on the specific node.

### 4.2 Security Layers
- **Native Odoo ACL Integration**: The IDE interface is tightly coupled with Odoo `ir.model.access`. If a user is Read-Only, the system strictly enforces state: blocking Interaction Mode, hiding toolbars, and restricting Node manipulation at the OWL component level.

---
---

## 🗺️ IMPLEMENTATION ROADMAP (3 REVIEW STAGES)

> [!TIP]
> The project has been divided into 3 distinct stages. At the end of each stage, development will pause to allow the USER to review, test, and comment before moving to the next phase.

### 🟢 STAGE 1: Data Architecture & Security Backbone
**Goal**: Establish the structural foundation, Odoo database models, and the basic Hybrid mechanism to ensure data is safely stored and permissions apply correctly.

**AI Execution Steps:**
- [x] Initialize the Odoo Module scaffolding (`flow_engine_pro`).
- [x] Create Python Models: `workflow.diagram`, `workflow.node`, `workflow.edge`.
- [x] Implement the `JSON` field scheme for the Canvas Data (The Blob), alongside relational search fields.
- [x] Establish `ir.model.access.csv` and `ir.rule` to bind the Security Layers.
- [x] Implement standard Tree/Form views and native actions.
- [x] **>>> [USER REVIEW 1 PAUSE] <<<** (Focus on: Schema logic, Menu items, Security behavior).

### 🟡 STAGE 2: The Core OWL Canvas & UX Interactions
**Goal**: Build the IDE Client Action utilizing OWL to host the Canvas API, establish rendering loops, and set up state management.

**AI Execution Steps:**
- [x] Register the Custom OWL Client Action to take over the screen.
- [x] Build the Base Canvas Component with Mouse Event handlers, Zoom, and Pan functionality.
- [x] Implement the `requestAnimationFrame` render loop at 60fps.
- [x] Implement **Spatial Hashing Logic** over the canvas (Invisible chunks for rendering speed).
- [x] Implement **State Management (Deltas)** framework for Undo/Redo.
- [x] Build the Command Center (Bottom bar UI & Sidebar layout).
- [x] **>>> [USER REVIEW 2 PAUSE] <<<** (Focus on: Canvas smoothness, UI aesthetic, performance).

### 🔴 STAGE 3: The Vector Math Engine & Routing
**Goal**: Implement the complex geometries, collision models, smart routing algorithms, and final polish details.

**AI Execution Steps:**
- [x] Create primitives algorithms (Rectangle, Diamond, Oval, Parallelogram, Comment Bubbles).
- [x] Implement **Collision Detection & Auto-Repel** logic across nodes.
- [x] Implement the Center-Point Logic & Marquee Selection system.
- [x] Develop the **Orthogonal Routing Algorithm** for Edges (Auto-avoidance).
- [x] Integrate the **Fillet Algorithm (`arcTo`)** for edge aesthetics.
- [x] Integrate JSON/SQL sync hook to push changes to the background database on save.
- [ ] Validate "Search & Pulse" mechanic.
- [ ] **>>> [USER REVIEW 3 PAUSE] <<<** (Focus on: Vector accuracy, edge aesthetics, overall UX).
