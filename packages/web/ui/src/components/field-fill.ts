import { createContext } from 'react'

// Whether a control stands in a form field, and should therefore be as wide
// as the field.
//
// A text input fills whatever it is put in; a select, closed, is as wide as
// its words. Side by side in a toolbar that is right. One under the other in
// a form it is a ragged edge - the input runs the width of the dialog and the
// select under it stops a third of the way across. The field says it is a
// field, and a select inside one fills it unless its caller sized it.
export const FieldFill = createContext(false)
