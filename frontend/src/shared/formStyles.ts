// Shared Tailwind utilities for floating labels and validation states.
export const fieldClassName =
  "group/field relative mt-2 block min-w-0 after:absolute after:right-[-1.25rem] after:top-[.85rem] after:hidden after:text-[#c2185b] after:content-['⚠'] has-[[aria-invalid=true]]:after:block has-[:user-invalid]:after:block";

export const fieldLabelClassName =
  'absolute -top-[.55rem] left-[.85rem] z-[1] max-w-[calc(100%-2rem)] truncate bg-white px-[.35rem] text-xs leading-[1.1rem] text-atlas-muted group-focus-within/field:text-[#645bff] group-has-[[aria-invalid=true]]/field:text-[#a4124a] group-has-[:user-invalid]/field:text-[#a4124a]';

export const controlClassName =
  'block min-h-[3.25rem] w-full rounded-[.6rem] border border-gray-300 bg-white px-[.8rem] py-2 text-sm leading-6 text-atlas-ink transition-[border-color,box-shadow] duration-150 placeholder:text-[#8b94a3] enabled:hover:border-[#7f8b9a] focus:border-[#645bff] focus:outline-none focus:shadow-[0_0_0_1px_#645bff] disabled:cursor-not-allowed disabled:bg-[#f5f5f6] disabled:text-[#7d838c] group-has-[[aria-invalid=true]]/field:border-[#c2185b] group-has-[[aria-invalid=true]]/field:shadow-[0_0_0_1px_#c2185b] group-has-[:user-invalid]/field:border-[#c2185b] group-has-[:user-invalid]/field:shadow-[0_0_0_1px_#c2185b] [&:is(textarea)]:min-h-[6.5rem] [&:is(textarea)]:resize-y';

export const fieldHelperClassName =
  'mt-[.35rem] block text-xs leading-[1.2rem] text-atlas-muted group-has-[[aria-invalid=true]]/field:text-[#a4124a] group-has-[:user-invalid]/field:text-[#a4124a]';

export const selectControlClassName = controlClassName.replace(/^block /, 'flex ');
