package com.dnaevolutions.moldqueen;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class CoreInfoTest {

    @Test
    void exposesModuleName() {
        assertEquals("moldqueen-java-core", CoreInfo.name());
    }
}
