import { cn } from '@/lib/utils'

// These are Tailwind 3 utilities. tailwind-merge 3 targets Tailwind 4 and leaves
// both legacy bg-gradient-to-* and bg-none in the output, making conflict
// resolution depend on stylesheet order instead of the caller's override.
describe('cn with the supported Tailwind 3 utilities', () => {
  it.each([
    ['bg-gradient-to-r bg-none', 'bg-none'],
    ['hover:bg-gradient-to-r hover:bg-none', 'hover:bg-none'],
    ['md:bg-gradient-to-r md:bg-none', 'md:bg-none'],
    ['bg-[url(/plane.svg)] bg-none', 'bg-none'],
    ['px-2 px-4', 'px-4'],
    ['px-2 py-1 p-4', 'p-4'],
    ['text-sm leading-6 text-lg/7', 'text-lg/7'],
    ['border-gray-200 border-red-500', 'border-red-500'],
    ['focus:ring-2 focus:ring-4', 'focus:ring-4'],
    ['hover:bg-red-500 bg-blue-500', 'hover:bg-red-500 bg-blue-500'],
  ])('resolves %s to %s', (input, expected) => {
    expect(cn(input)).toBe(expected)
  })

  it('combines conditional and nested class inputs before resolving conflicts', () => {
    expect(cn('px-2', false, ['py-1', null], { 'p-4': true, hidden: false }))
      .toBe('p-4')
  })
})
