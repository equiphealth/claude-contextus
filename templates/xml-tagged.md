[contextus — {{count}} patterns]

{{#each patterns}}
<context-pattern name="{{filename}}" type="{{type}}" similarity="{{similarity}}">
{{#heading}}Section: {{heading}}
{{/heading}}
{{body}}
</context-pattern>

{{/each}}