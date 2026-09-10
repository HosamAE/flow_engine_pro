/** @odoo-module **/

export class StateManager {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
        this.maxStack = 20;
    }
    
    execute(command) {
        command.execute();
        this.undoStack.push(command);
        if (this.undoStack.length > this.maxStack) this.undoStack.shift();
        this.redoStack = [];
    }
    
    undo() {
        if (this.undoStack.length === 0) return;
        const command = this.undoStack.pop();
        command.undo();
        this.redoStack.push(command);
    }
    
    redo() {
        if (this.redoStack.length === 0) return;
        const command = this.redoStack.pop();
        command.execute();
        this.undoStack.push(command);
    }
}

// Example Command Template
export class Command {
    execute() {}
    undo() {}
}
