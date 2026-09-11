{
    'name': 'Odoo Flow Engine Pro',
    'version': '17.0.1.6.0',
    'category': 'Productivity',
    'summary': 'Enterprise-Grade Workflow IDE for Odoo (Canvas Matrix)',
    'description': """
        Odoo Flow Engine Pro (V1.5)
        - Vector Engine & Canvas Matrix
        - Smart Orthogonal Routing
        - Hybrid Storage (JSON/SQL)
    """,
    'author': 'HosamAE',
    'depends': ['base', 'web'],
    'data': [
        'security/flow_security_groups.xml',
        'security/ir_rules.xml',
        'security/ir.model.access.csv',
        'views/workflow_diagram_views.xml',
        'views/res_config_settings_views.xml',
        'views/menu_views.xml',
    ],
    'demo': [
        'demo/demo.xml',
    ],
    'images': ['static/description/banner.png'],
    'assets': {
        'web.assets_backend': [
            'flow_engine_pro/static/src/fields/flow_diagram_field.js',
            'flow_engine_pro/static/src/fields/flow_diagram_field.xml',
            'flow_engine_pro/static/src/core/math_utils.js',
            'flow_engine_pro/static/src/core/flowchart_rules.js',
            'flow_engine_pro/static/src/settings/flow_appearance_preview.js',
            'flow_engine_pro/static/src/settings/flow_appearance_preview.xml',
            'flow_engine_pro/static/src/components/toolbar/toolbar.js',
            'flow_engine_pro/static/src/components/toolbar/toolbar.xml',
            'flow_engine_pro/static/src/components/canvas/canvas_routing.js',
            'flow_engine_pro/static/src/components/canvas/canvas_layout.js',
            'flow_engine_pro/static/src/components/canvas/canvas_interaction.js',
            'flow_engine_pro/static/src/components/canvas/canvas.js',
            'flow_engine_pro/static/src/components/canvas/canvas.xml',
            'flow_engine_pro/static/src/flow_ide/flow_help_dialog.js',
            'flow_engine_pro/static/src/flow_ide/flow_help_dialog.xml',
            'flow_engine_pro/static/src/flow_ide/flow_ide.js',
            'flow_engine_pro/static/src/flow_ide/flow_ide.xml',
            'flow_engine_pro/static/src/flow_ide/flow_ide.scss',
        ],
        'web.assets_web_dark': [
            'flow_engine_pro/static/src/flow_ide/flow_ide_dark.scss',
        ],
    },
    'installable': True,
    'application': True,
    # OPL-1 (Odoo Proprietary License v1.0), not LGPL-3 - this is the paid,
    # closed-source license Odoo Apps store sellers use: a buyer may use it
    # and build on top of it for their own purposes, but may not resell,
    # sublicense, or redistribute the module (original or modified) under
    # anyone else's name. LGPL-3 is a permissive open-source license that
    # explicitly allows redistribution and even commercial resale of
    # modified copies - the opposite of what was asked for (chat history
    # 2026-09-08). Matches the license already used by this same
    # developer's other paid Highnox apps (e.g. highnox_floor_plan).
    'license': 'OPL-1',
}
