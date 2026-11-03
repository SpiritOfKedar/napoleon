package com.napoleon.service;

/** Converts float arrays to pgvector's text literal, e.g. {@code [0.1,0.2,0.3]}. */
public final class VectorFormat {

    private VectorFormat() {}

    public static String toLiteral(float[] vector) {
        StringBuilder sb = new StringBuilder(vector.length * 12).append('[');
        for (int i = 0; i < vector.length; i++) {
            if (i > 0) {
                sb.append(',');
            }
            // Float.toString is locale-independent (always '.' as decimal separator).
            sb.append(Float.toString(vector[i]));
        }
        return sb.append(']').toString();
    }
}
