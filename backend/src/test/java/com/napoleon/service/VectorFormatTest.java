package com.napoleon.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Locale;
import org.junit.jupiter.api.Test;

class VectorFormatTest {

    @Test
    void formatsAsPgvectorLiteral() {
        assertThat(VectorFormat.toLiteral(new float[] {0.5f, -1f, 0.25f})).isEqualTo("[0.5,-1.0,0.25]");
    }

    @Test
    void ignoresDefaultLocale() {
        Locale previous = Locale.getDefault();
        try {
            Locale.setDefault(Locale.GERMANY); // uses ',' as the decimal separator
            assertThat(VectorFormat.toLiteral(new float[] {1.5f})).isEqualTo("[1.5]");
        } finally {
            Locale.setDefault(previous);
        }
    }
}
